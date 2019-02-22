#!/bin/bash
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright (c) 2019, Joyent, Inc.
#

#
# Note, this is a workaround script, currently only intended for manual use
# when it is not possible to obtain a directory listing in
# /poseidon/stor/manta_gc/mako/<storage_id>
#

N=$1
PIDS=

mkdir -p logs


for i in $(seq $N);
do
	node main.js -f "etc/config-$((i - 1)).json" &> "logs/feeder-$((i - 1)).log" &
	PIDS="$! $PIDS"
done;

disown;

echo $PIDS
