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
var mod_verror = require('verror');

var VError = mod_verror.VError;

var DEFAULT_BATCH_SIZE = 10000;

/*
 * These variables must be set on a per-deployment basis.
 */
var POSEIDON_UUID = 'ff30b6ca-566a-e73e-9b74-911b9fe9db45';
var DOMAIN = 'orbit.example.com';
var INSTRUCTIONS_DIR = '/var/tmp/mako_gc_instructions';
var STREAMS_DB_DIR = '/var/tmp/mako_gc_streams_dbs';
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
	mod_assertplus.optionalNumber(opts.batch_size, 'opts.batch_size');
	mod_assertplus.string(opts.shard_domain, 'opts.shard_domain');
	mod_assertplus.string(opts.nameservice, 'opts.nameservice');

	this.f_log = mod_bunyan.createLogger({
	    name: 'MakoGcFeeder',
	    level: process.LOG_LEVEL || 'info'
	});

	this.f_shard = opts.shard_domain;
	this.f_nameservice = opts.nameservice;
	this.f_batch_size = opts.batch_size || DEFAULT_BATCH_SIZE;

	/*
	 * Moray client used by this feeder. Each has exactly one.
	 */
	this.f_morayclient = null;

	/*
	 * The last error seen by this feeder.
	 */
	this.f_lastErr = null;

	/*
	 * Filter to be used for the next findobjects.
	 */
	this.f_morayfilter = null;

	/*
	 * Delay between findobjects rpcs.
	 */
	this.f_delay = 5000;

	/*
	 * For each storage_id we find in Moray, we save a descriptor object
	 * that contains a write stream for the file to which we're writing
	 * instructions for that storage_id.
	 */
	this.f_filestreams = {};

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
	this.f_db_path = [
	    STREAMS_DB_DIR,
	    this.f_shard + '-stream_position.db'
	].join('/');
	this.f_db = null;

	/*
	 * Range of possible _key s.
	 */
	this.f_start = BOTTOM;
	this.f_end = TOP;

	var self = this;

	this.f_morayclient = mod_moray.createClient({
	    log: self.f_log.child({
		component: 'MorayClient-' + self.f_shard,
	    }),
	    srvDomain: self.f_shard,
	    cueballOptions: {
		resolvers: [ self.f_nameservice ],
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

	mod_vasync.pipeline({ funcs: [
		function createStreamDbTmpDirs(_, next) {
			mod_mkdirp(STREAMS_DB_DIR, next);
		},
		function initdb(_, next) {
			self.f_db = new mod_sqlite.Database(self.f_db_path);
			next();
		},
		/*
		 * Create a sqlite database storing the latest _key found in the
		 * stream.
		 */
		function createDatabase(_, next) {
			self.f_db.run('CREATE TABLE IF NOT EXISTS stream_position ' +
			    '(timestamp TEXT, marker TEXT)', next);
		},
		/*
		 * If this program crashed and restarted, it's possible for us
		 * to resume it from the last _key it read in it's previous run.
		 */
		function checkForPreviousRun(_, next) {
			self.f_db.get('SELECT * FROM stream_position',
			    function (serr, row) {
				if (serr) {
					next(new VError('Unable to determine ' +
					    'stream position \'%s\'', serr));
					return;
				}
				/*
				 * If we have a stream_position table, but it
				 * dones't have a marker -- create one.
				 */
				if (row === undefined) {
					var args = [
					    (new Date()).toISOString(),
					    self.f_start
					];
					self.f_db.run('INSERT INTO stream_position ' +
					    'VALUES (?, ?)', args);
					next();
					return;
				}

				if (!row.hasOwnProperty('marker')) {
					next(new VError('Malformed stream_position ' +
					    'table. Missing \'marker\' column.'));
					return;
				} else {
					self.f_log.info('Resuming scan from previous ' +
					    'run at \'%s\'', self.f_start);
				}

				self.f_start = row['marker'] || BOTTOM;
				next();
			});
		},
		/*
		 * Instruction object listings with metadata on 'SHARD_URL' for
		 * shrimp with manta_sorage_id 'STORAGE_ID' are stored in:
		 *
		 * /var/tmp/mako_gc_inputs/SHARD_URL/STORAGE_ID
		 */
		function createListingDirectories(_, next) {
			mod_mkdirp([INSTRUCTIONS_DIR, self.f_shard].join('/'),
			    function (err) {
				self.f_log.debug('Created local listing directories');
				next(err);
			});
		},
		/*
		 * Connect to Moray.
		 */
		function waitForMorayConnection(_, next) {
			self.f_log.debug('Waiting for Moray connection');
			if (self.f_morayclient.connected) {
				next();
				return;
			}
			self.f_morayclient.once('connect', function () {
				self.f_log.debug('Moray client connected.');
				next();
			});
		}
	] }, function (err) {
		if (err) {
			self.f_log.error('Error initializing: \'%s\'', err);
			self.f_lastErr = err;

			S.gotoState('done');
			return;
		}
		self.updateMorayFilter();

		self.f_log.debug('Finished initializing');

		S.gotoState('running');
	});
}

MakoGcFeeder.prototype.state_running = function (S)
{
	var self = this;

	self.readChunk(function (err) {
		/*
		 * The upper bound on the _key range we're searching is
		 * exclusive. This means that even when we've processed the
		 * entire range of instruction objects on a shard, we'll always
		 * still receive one more record if we try restarting the
		 * process.
		 */
		if (self.f_numLastSeen === 1 && self.f_batch_size > 1) {
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

	mod_vasync.forEachParallel({
		inputs: Object.keys(self.f_filestreams),
		func: function (storage_id, done) {
			var entry = self.f_filestreams[storage_id];

			entry.stream.on('finish', function () {
				self.f_log.info('Finished writing \'%s\'',
				    entry.path);
				done();
			});
			entry.stream.end();
		}
	}, function (err) {
		/*
		 * Close stream position database.
		 */
		self.f_db.close();

		if (self.f_lastErr) {
			process.exit(1);
		}
		process.exit(0);
	});
};

/*
 * Instruction objects are stored in /poseidon/stor/manta_gc/mako/<storage_id>.
 * We extract the storage_id from the path here.
 */
function extractStorageId(path)
{
	return (path.split('/')[5]);
}

MakoGcFeeder.prototype.checkpoint = function ()
{
	var self = this;
	self.f_db.run('UPDATE stream_position SET timestamp = ?, marker = ?',
	    [(new Date()).toISOString(), self.f_start]);
};

MakoGcFeeder.prototype.appendToListingFile = function (path)
{
	var self = this;
	var storage_id = extractStorageId(path);

	var file = [INSTRUCTIONS_DIR, self.f_shard, storage_id].join('/');

	/*
	 * If this is the first time we're writing to this file, establish a
	 * write stream.
	 */
	if (!self.f_filestreams.hasOwnProperty(storage_id)) {
		self.f_filestreams[storage_id] = {
			lastError: null,
			/*
			 * Append-only. We may be resuming the listing after
			 * crashing.
			 */
			stream: mod_fs.createWriteStream(file, {
			    flags: 'a'
			}),
			path: file
		};
		self.f_filestreams[storage_id].stream.on('error',
		    function (err) {
			self.f_filestreams[storage_id].lastError = err;
			self.f_log.error('Error writing file \'%s\': \'%s\'',
			    file, err);
		});
	}

	self.f_filestreams[storage_id].stream.write(path + '\n');
	self.f_numwritten++;

	/*
	 * Advance our marker.
	 */
	if (self.f_start < path) {
		self.f_start = path;
	}

	/*
	 * Update moray filter for future now that our bounds are updated.
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
	};

	var req = self.f_morayclient.findObjects('manta', self.f_morayfilter,
	    findOpts);

	req.on('record', function (record) {
		var key = record.key;

		self.f_numLastSeen++;
		self.f_numseen++;

		var err = self.appendToListingFile(key);
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
		self.checkpoint();

		self.f_log.info({
		    seenNow: self.f_numLastSeen,
		    seenCumulative: self.f_numseen,
		    numWritten: self.f_numwritten
		}, 'findobjects: done');
		cb();
	});
};

function main()
{
	var opts;
	var file = mod_path.join('etc', 'config.json');
	var feeders = {};

	mod_fs.readFile(file, function (err, data) {
		if (err) {
			throw (err);
		}
		try {
			opts = JSON.parse(data.toString('utf8'));
		} catch (e) {
			throw (e);
		}

		mod_assertplus.arrayOfObject(opts.shards, 'opts.shard');
		mod_assertplus.string(opts.nameservice, 'opts.nameservice');
		mod_assertplus.number(opts.batch_size, 'opts.batch_size');

		opts.shards.forEach(function (shard) {
			mod_assertplus.string(shard.host, 'shard.host');
			var options = {
				batch_size: opts.batch_size,
				shard_domain: shard.host,
				nameservice: opts.nameservice
			};
			feeders[shard.host] = new MakoGcFeeder(options);
		});
	});
}

main();
