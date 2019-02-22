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

INSTR_OBJ_DIR="/var/tmp/mako_gc_instructions"
REMOTE_INSTR_OBJ_DIR="/var/tmp/mako_gc_instructions"
ZONES_STORAGEIDS="/var/tmp/storage_zones.txt"

# Clear the staging area

which manta-oneach &>/dev/null
if [ $? == 1 ];
then
	echo "Could not find `manta-oneach`"
	exit 1
fi;

which manta-adm &> /dev/null
if [ $? == 1 ];
then
	echo "Could not find `manta-adm`"
	exit 1
fi;

manta-oneach -s storage "mkdir -p ${REMOTE_INSTR_OBJ_DIR}"

if [ ! -f ${ZONES_STORAGEIDS} ];
then
	manta-adm show storage -H -a -o storage_id,zonename > ${ZONES_STORAGEIDS}
fi;

for SHARD in $(ls "${INSTR_OBJ_DIR}");
do
	for STORAGE_ID in $(ls "${INSTR_OBJ_DIR}/${SHARD}");
	do
		LISTING="${INSTR_OBJ_DIR}/${SHARD}/${STORAGE_ID}"
		MOVED="$LISTING-$(zonename)-$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

		mv "$LISTING" "$MOVED"

		ZONE="$(grep "${STORAGE_ID}" ${ZONES_STORAGEIDS} | \
		    awk '{print $2}')"

		manta-oneach -z ${ZONE} -d ${REMOTE_INSTR_OBJ_DIR} -g ${MOVED}
	done;
done;
