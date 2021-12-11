#!/bin/sh

#######################################################################
# This program and the accompanying materials are made available
# under the terms of the Eclipse Public License v2.0 which
# accompanies this distribution, and is available at
# https://www.eclipse.org/legal/epl-v20.html
#
# SPDX-License-Identifier: EPL-2.0
#
# Copyright Contributors to the Zowe Project.
#######################################################################

print_level0_message "Starting Zowe"

###############################
# validation
require_zowe_yaml


# read job name and validate
jobname=$(read_yaml "${ZWE_CLI_PARAMETER_CONFIG}" ".zowe.job.name")
if [ "${jobname}" = "null" ]; then
  jobname=
fi
security_stcs_zowe=$(read_yaml "${ZWE_CLI_PARAMETER_CONFIG}" ".zowe.setup.security.stcs.zowe")
if [ -z "${security_stcs_zowe}" -o "${security_stcs_zowe}" = "null" ]; then
  security_stcs_zowe=${ZWE_PRIVATE_DEFAULT_ZOWE_STC}
fi
route_sysname=
sanitize_ha_instance_id
if [ -n "${ZWE_CLI_PARAMETER_HA_INSTANCE}" ]; then
  route_sysname=$(read_yaml "${ZWE_CLI_PARAMETER_CONFIG}" ".haInstances.${ZWE_CLI_PARAMETER_HA_INSTANCE}.sysname")
  if [ -z "${route_sysname}" -o "${route_sysname}" = "null" ]; then
    print_error_and_exit "Error ZWEL0157E: Zowe HA instance SYSNAME (haInstances.${ZWE_CLI_PARAMETER_HA_INSTANCE}.sysname) is not defined in Zowe YAML configuration file." "" 157
  fi
fi

###############################
# start job
cmd="S ${security_stcs_zowe}"
if [ -n "${ZWE_CLI_PARAMETER_HA_INSTANCE}" ]; then
  cmd="${cmd},HAINST=${ZWE_CLI_PARAMETER_HA_INSTANCE}"
fi
if [ -n "${jobname}" ]; then
  cmd="${cmd},JOBNAME=${jobname}"
fi
if [ -n "${route_sysname}" ]; then
  cmd="RO ${route_sysname},${cmd}"
fi
result=$(operator_command "${cmd}")
code=$?
if [ ${code} -ne 0 ]; then
  print_error_and_exit "Error ZWEL0165E: Failed to start ${security_stcs_zowe}: exit code ${code}." "" 165
else
  error_message=$(echo "${result}" | awk "/-S ${security_stcs_zowe}/{x=NR+1;next}(NR<=x){print}" | sed "s/^\([^ ]\+\) \+\([^ ]\+\) \+\([^ ]\+\) \+\(.\+\)\$/\4/" | trim)
  if [ -n "${error_message}" ]; then
    print_error_and_exit "Error ZWEL0165E: Failed to start ${security_stcs_zowe}: ${error_message}." "" 165
  fi
fi

###############################
# exit message
print_level1_message "Job ${security_stcs_zowe} is started successfully."

