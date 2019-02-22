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

		ZONE="$(grep "${STORAGE_ID}" ${ZONES_STORAGEIDS} | \
		    awk '{print $2}')"

		manta-oneach -z ${ZONE} -d ${REMOTE_INSTR_OBJ_DIR} -g ${LISTING}
	done;
done;
