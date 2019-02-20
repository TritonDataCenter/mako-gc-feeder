/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2019, Joyent, Inc.
 */

var mod_assertplus = require('assert-plus');
var mod_events = require('events');
var mod_fs = require('fs');
var mod_fsm = require('mooremachine');
var mod_bunyan = require('bunyan');
var mod_mkdirp = require('mkdirp');
var mod_moray = require('moray');
var mod_morayfilter = require('moray-filter');
var mod_path = require('path');
var mod_sqlite = require('sqlite3');
var mod_util = require('util');
var mod_vasync = require('vasync');

var BATCH_SIZE = 100;

/*
 * These variables must be set on a per-deployment basis.
 */
var POSEIDON_UUID = 'ff30b6ca-566a-e73e-9b74-911b9fe9db45';
var DOMAIN = 'orbit.example.com';
var TMPDIR = '/var/tmp/mako_gc_inputs';
var MIN_SHRIMP = 1;
var MAX_SHRIMP = 3;

/*
 * The ASCII character '~' compares highest against all others.
 * Hence, the TOP string is the maximum possible '_key' of any
 * instruction object.
 */
var TOP = '/' + POSEIDON_UUID + '/stor/manta_gc/mako/' + MAX_SHRIMP + '.stor.' + DOMAIN + '/' + ('~'.repeat(125));
var BOTTOM = '/' + POSEIDON_UUID + '/stor/manta_gc/mako/' + MIN_SHRIMP + '.stor.' + DOMAIN;

function MakoGcFeeder(opts)
{
	mod_assertplus.number(opts.shard, 'opts.shard');

	this.f_log = mod_bunyan.createLogger({ name: 'MakoGcFeeder' });
	this.f_shard = [opts.shard, 'moray', DOMAIN].join('.');
	this.f_nameservice = ['nameservice', DOMAIN].join('.');
	this.f_batch_size = BATCH_SIZE;
	this.f_morayclient = null;

	/*
	 * Filter to be used for the next findobjects.
	 */
	this.f_morayfilter = null;

	/*
	 * Delay between findobjects rpcs.
	 */
	this.f_delay = 5000;

	/*
	 * Last path seen by the program.
	 */
	this.f_numLastSeen = 0;

	/*
	 * Total number of paths seen by the program.
	 */
	this.f_numseen = 0;
	this.f_numwritten = 0;

	/*
	 * SQLite db used to store stream position.
	 */
	this.f_db = new mod_sqlite.Database('mako_gc_feeder.db');

	/*
	 * Range of possible _key s.
	 */
	this.f_start = BOTTOM;
	this.f_end = TOP;

	this.f_morayclient = mod_moray.createClient({
	    log: this.f_log.child({ component: 'MorayClient' }),
	    srvDomain: this.f_shard,
	    cueballOptions: {
		resolvers: [ this.f_nameservice ],
		defaultPort: 2020
	    }
	});

	mod_fsm.FSM.call(this, 'init');
};
mod_util.inherits(MakoGcFeeder, mod_fsm.FSM);

MakoGcFeeder.prototype.updateMorayFilter = function ()
{
	var self = this;
	/*
	 * Set up moray filter for findobjects.
	 */
	var filter = new mod_morayfilter.AndFilter();
	filter.addFilter(new mod_morayfilter.GreaterThanEqualsFilter({
		attribute: '_key',
		value: self.f_start
	}));
	filter.addFilter(new mod_morayfilter.LessThanEqualsFilter({
		attribute: '_key',
		value: self.f_end
	}));
	self.f_morayfilter = filter.toString();
};

MakoGcFeeder.prototype.state_init = function (S)
{
	var self = this;

	self.updateMorayFilter();

	mod_vasync.pipeline({ funcs: [
		function createDatabase(_, next) {
			self.f_db.run('CREATE TABLE IF NOT EXISTS stream_position ' +
			    '(timestamp TEXT, marker TEXT)', next);
		},
		function checkForPreviousRun(_, next) {
			self.f_db.get('SELECT * FROM stream_position', function (serr, row) {
				if (serr) {
					self.f_log.error('Error reading from stream position ' +
					    'table: \'%s\'', serr);
					next(serr);
					return;
				}
				if (row !== undefined && !row.hasOwnProperty('marker')) {
					self.f_log.error('Found stream_position table, but ' +
					    'missing marker path. This is unexpected.');
					next(new Error('unexpected condition'));
					return;
				}
				if (row === undefined) {
					self.f_db.run('INSERT INTO stream_position VALUES (?, ?)',
					    [(new Date()).toISOString(), self.f_start]);
				}

				self.f_start = (row !== undefined) ? row['marker'] || BOTTOM : BOTTOM;
				if (row !== undefined && row.hasOwnProperty('marker')) {
					self.f_log.info('Found marker from previous run. Resuming at ' +
					    '\'%s\'', self.f_start);
				}
				next();
			});
		},
		function createListingDirectories(_, next) {
			mod_mkdirp([TMPDIR, self.f_shard].join('/'), function (err) {
				self.f_morayclient.on('connect', function () {
					self.f_log.debug('Moray client connected.');
					next();
				});
			});
		}
	] }, function (err) {
		if (err) {
			self.f_log.error('Error initializing: \'%s\'', err);
			process.exit(1);
		}
		S.gotoState('running');
	});
}

MakoGcFeeder.prototype.state_running = function (S)
{
	var self = this;

	self.readChunk(function (err) {
		if (self.f_numLastSeen === -1) {
			self.f_log.info('Finished reading instruction objects.');
			S.gotoState('done');
			return;
		}
		setTimeout(function () {
			S.gotoState('running');
		}, self.f_delay);
	});
};

MakoGcFeeder.prototype.state_done = function (S)
{
	var self = this;

	self.f_log.info('Finished listing instruction objects.');
	self.f_db.close();
	process.exit(0);
};

/*
 * Instruction objects are stored in /poseidon/stor/manta_gc/mako/<storage_id>.
 * We extract the storage_id from the path here.
 */
function extractStorageId(path)
{
	return (path.split('/')[5]);
}

MakoGcFeeder.prototype.writeToListing = function (path)
{
	var self = this;

	self.f_db.run('UPDATE stream_position SET timestamp = ?, marker = ?',
	    [(new Date()).toISOString(), path]);

	var file = [TMPDIR, self.f_shard, extractStorageId(path)].join('/');
	var err = mod_fs.appendFileSync(file, path + '\n');
	if (err) {
		return (err);
	}

	self.f_numwritten++;

	/*
	 * Advance our marker.
	 */
	if (self.f_start < path) {
		self.f_start = path;
	}

	/*
	 * Update moray filter for future findObjects.
	 */
	self.updateMorayFilter();
};

MakoGcFeeder.prototype.readChunk = function (cb) {
	var self = this;
	var seen = {};

	var findOpts = {
		limit: self.f_batch_size,
		sort: {
			attribute: '_key',
			order: 'ASC'
		},
		no_count: true
	}
	var req = self.f_morayclient.findObjects('manta', self.f_morayfilter,
	    findOpts);

	req.on('record', function (record) {
		var key = record.key;

		self.f_numLastSeen++;
		self.f_numseen++;

		if (seen.hasOwnProperty(key)) {
			self.f_log.warn('Recieved duplicate key \'%s\'', key);
		}
		seen[key] = true;

		var err = self.writeToListing(key);
		if (err) {
			self.f_log.error('Error writing to listing \'%s\'', key);
			return;
		}
	});

	req.on('error', function (err) {
		self.f_log.error('Error listing records: \'%s\'', err);
		cb(err);
	});

	req.once('end', function () {
		if (self.f_numLastSeen === 0) {
			self.f_log.info('No records remaining.');
			cb();
			return;
		}
		self.f_log.info('Records seen: %d, Records seen cumulative: %d, ' +
		    'Records written cumulative: %d', self.f_numLastSeen,
		    self.f_numseen, self.f_numwritten);

		/*
		 * Indicate to the caller that we have reached the end of the
		 * stream if we received 0 records. Otherwise, reset the counter
		 * for the next run.
		 */
		if (self.f_numLastSeen === 0) {
			self.f_numLastSeen = -1;
		} else {
			self.f_numLastSeen = 0;
		}
		cb();
	});
};

var feeder = new MakoGcFeeder({ shard: 2 });
