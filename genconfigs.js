/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2019, Joyent, Inc.
 */

var mod_bunyan = require('bunyan');
var mod_fs = require('fs');
var mod_jsprim = require('jsprim');
var mod_path = require('path');
var mod_sdc = require('sdc-clients');


function main()
{
	var nprocs = parseInt(process.argv[2]);
	var file = mod_path.join('etc', 'config.json.template');
	var cfg;

	mod_fs.readFile(file, function (err, data) {
		try {
			cfg = JSON.parse(data.toString('utf8'));
		} catch (err) {
			throw (err);
		}
		
		var sapi = new mod_sdc.SAPI({
			log: mod_bunyan.createLogger({ name: 'SAPI' }),
			url: cfg.sapi_url,
			agent: false,
			version: '*'
		});
		
		var opts = {
			name: 'manta',
			include_master: true
		};

		sapi.listApplications(opts, function (err, apps) {
			if (err) {
				throw (err);
			}
			if (apps.length !== 1) {
				throw (new Error('found multiple Manta applications'));
			}
			var app = apps[0];

			var shards = app.metadata['INDEX_MORAY_SHARDS'];

			var cfgs = [];

			for (var i = 0; i < nprocs; i++) {
				cfgs.push(mod_jsprim.deepCopy(cfg));
				cfgs[cfgs.length - 1].shards = [];
			}
			i = 0;

			for (var s = 0; s < shards.length; s++) {
				var shard = shards[s];
				cfgs[i].shards.push({
					host: shard.host
				});
				i = (i + 1) % nprocs;
			}

			for (i = 0; i < cfgs.length; i++) {
				var json = JSON.stringify(cfgs[i]);
				var cfgfile = mod_path.join('etc', 'config-' + i + '.json');
				mod_fs.writeFileSync(cfgfile, json);
			}
		});
	});
}

main();
