#!/bin/bash
# -*- mode: shell-script; fill-column: 80; -*-
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright (c) 2019, Joyent, Inc.
#

set -o xtrace

SOURCE="${BASH_SOURCE[0]}"
if [[ -h $SOURCE ]]; then
    SOURCE="$(readlink "$SOURCE")"
fi
DIR="$( cd -P "$( dirname "$SOURCE" )" && pwd )"
PROFILE=/root/.bashrc
SVC_ROOT=/opt/smartdc/mako-gc-feeder
NODE_BIN=$SVC_ROOT/build/node/bin

source ${DIR}/scripts/util.sh
source ${DIR}/scripts/services.sh

export PATH=$SVC_ROOT/build/node/bin:$SVC_ROOT/node_modules/.bin:/opt/local/bin:/usr/sbin:/usr/bin:$PATH

function wait_for_resolv_conf {
    local attempt=0
    local isok=0
    local num_ns

    while [[ $attempt -lt 30 ]]
    do
        num_ns=$(grep nameserver /etc/resolv.conf | wc -l)
        if [ $num_ns -gt 1 ]
        then
		    isok=1
		    break
        fi
	    let attempt=attempt+1
	    sleep 1
    done
    [[ $isok -eq 1 ]] || fatal "manatee is not up"
}


function manta_setup_mako_gc_feeder {
    local num_instances=30
    local size=`json -f ${METADATA} SIZE`

    pushd .

    cd $SVC_ROOT 

    $NODE_BIN/node $SVC_ROOT/genconfigs.js $num_instances

    popd

    #To preserve whitespace in echo commands...
    IFS='%'

    local mako_gc_feeder_xml_in=$SVC_ROOT/smf/manifests/mako-gc-feeder.xml.in
    for (( i=0; i<$num_instances; i++ )); do
        local mako_gc_feeder_instance="mako-gc-feeder-${i}"
        local mako_gc_feeder_xml_out=$SVC_ROOT/smf/manifests/mako-gc-feeder-${i}.xml
        sed -e "s#@@MAKO_GC_FEEDER_INSTANCE_NUM@@#${i}#g" \
            -e "s#@@MAKO_GC_FEEDER_INSTANCE_NAME@@#${mako_gc_feeder_instance}#g" \
            $mako_gc_feeder_xml_in  > $mako_gc_feeder_xml_out || \
            fatal "could not process $mako_gc_feeder_xml_in to $mako_gc_feeder_xml_out"

        svccfg import $mako_gc_feeder_xml_out || \
            fatal "unable to import $mako_gc_feeder_instance: $mako_gc_feeder_xml_out"
        svcadm enable "$mako_gc_feeder_instance" || \
            fatal "unable to start $mako_gc_feeder_instance"
        sleep 1
    done

    unset IFS
}

wait_for_resolv_conf
manta_setup_mako_gc_feeder

exit 0
