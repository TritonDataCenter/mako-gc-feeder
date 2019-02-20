var mod_assertplus = require('assert-plus');
var mod_events = require('events');
var mod_fs = require('fs');
var mod_fsm = require('mooremachine');
var mod_bunyan = require('bunyan');
var mod_moray = require('moray');
var mod_morayfilter = require('moray-filter');
var mod_sqlite = require('sqlite3');
var mod_util = require('util');

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
var TOP = '/' + POSEIDON_UUID + '/stor/manta_gc/mako/' + MAX_SHRIMP + '.stor.' + DOMAIN + '/~';
var BOTTOM = '/' + POSEIDON_UUID + '/stor/manta_gc/mako/' + MIN_SHRIMP + '.stor.' + DOMAIN;

function MakoGcFeeder(opts)
{
	mod_assertplus.number(opts.shard, 'opts.shard');

	this.f_log = mod_bunyan.createLogger({ name: 'MakoGcFeeder' });
	this.f_shard = [opts.shard, 'moray', DOMAIN].join('.');
	this.f_nameservice = ['nameservice', DOMAIN].join('.');
	this.f_batch_size = BATCH_SIZE;
	this.f_morayclient = null;
	this.f_morayfilter = null;
	this.f_delay = 5000;
	this.f_numLastSeen = 0;

	this.f_db = new mod_sqlite.Database('mako_gc_feeder.db');

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

MakoGcFeeder.prototype.state_init = function (S)
{
	var self = this;

	/*
	 * Check for the existence of the stream_position table.
	 */
	self.f_db.get('SELECT name FROM sqlite_master WHERE type=? AND name=?',
	    ['table', 'stream_position'], function (err, present) {
		if (err) {
			self.f_log.error('Error checking for stream_position table ' +
				'\'%s\'', err);
		}

		/*
		 * If the table is present, resume listing at the last path that
		 * was written to the stream position.
		 */
		if (present !== undefined) {
			self.f_db.get('SELECT * FROM stream_position', function (serr, row) {
				if (serr) {
					self.f_log.error('Error reading from stream position ' +
					    'table: \'%s\'', serr);
				}
				if (row === undefined || row['marker'] === undefined) {
					self.f_log.error('Found stream_position table, but ' +
					    'missing marker path');
					process.exit(1);
				}
				self.f_start = row['marker'] || TOP;
				self.f_log.info('Found marker from previous run. Resuming at ' +
				    '\'%s\'', self.f_start);
			});
		} else {
			self.f_db.run('INSERT INTO stream_position VALUES (?, ?)',
				[(new Date()).toISOString(), self.f_start]);
		}
	});

	self.f_db.run('CREATE TABLE IF NOT EXISTS stream_position (timestamp TEXT, marker TEXT)');

	/*
	 * Create the temporary directory with the following hierarchy:
	 *
	 * /var/tmp/mako_gc_inputs/SHARD_SRV_DOMAIN/
	 *
	 * The files in these directories are named for the manta_storage_ids to
	 * which the corresponding instructions should be uploaded. Chunking
	 * these files is left up to the operator.
	 */
	mod_fs.mkdir([TMPDIR, self.f_shard].join('/'), function (err) {
		self.f_morayclient.on('connect', function () {
			self.f_log.debug('Moray client connected.');
			S.gotoState('running');
		});
	});
}

MakoGcFeeder.prototype.state_running = function (S)
{
	var self = this;

	self.readChunk(function (err) {
		/*
		 * Exhausted instruction objects stored on this shard.
		 */
		if (self.f_numLastSeen == 0) {
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

MakoGcFeeder.prototype.writeToListing = function (path, cb)
{
	var self = this;

	var file = [TMPDIR, self.f_shard, extractStorageId(path)].join('/');

	self.f_db.run('UPDATE stream_position SET timestamp = ?, marker = ?',
	    [(new Date()).toISOString(), path]);

	mod_fs.appendFile(file, path + '\n', function (err) {
		if (err) {
			self.f_log.error('Error writing file \'%s\': \'%s\'',
			    file, err);
		}
		cb();
	});
};

MakoGcFeeder.prototype.readChunk = function (cb) {
	var self = this;
	var lastSeen;
	var numSeen = 0;

	var query = mod_util.format('SELECT * FROM manta WHERE' +
	    ' _key >= \'%s\' AND _key < \'%s\' AND type = \'object\';',
	    self.f_start, self.f_end);

	self.f_log.info(query);

	var req = self.f_morayclient.sql(query, {
		limit: self.f_batch_size,
		no_count: true
	});

	req.on('record', function (record) {
		self.f_log.debug('Found record \'%s\'', record._key);
		self.writeToListing(record._key, function () {
			lastSeen = record._key;
			numSeen++;
		});
	});

	req.on('error', function (err) {
		self.f_log.error('Error listing records: %s', err);
		cb(err);
	});

	req.once('end', function () {
		if (numSeen == 0) {
			self.f_log.info('No records remaining.');
			return;
		}
		self.f_log.info('Done. Read %d records.', numSeen);
		self.f_start = lastSeen;
		self.f_numLastSeen = numSeen;
		cb();
	});
};

var feeder = new MakoGcFeeder({ shard: 2 });
