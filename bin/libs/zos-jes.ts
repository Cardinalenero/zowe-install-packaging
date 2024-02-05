/*
  This program and the accompanying materials are made available
  under the terms of the Eclipse Public License v2.0 which
  accompanies this distribution, and is available at
  https://www.eclipse.org/legal/epl-v20.html
 
  SPDX-License-Identifier: EPL-2.0
 
  Copyright Contributors to the Zowe Project.
*/

import * as os from 'cm_os';
import * as zoslib from './zos';
import * as common from './common';
import * as stringlib from './string';
import * as shell from './shell';

export function submitJob(jclFile: string): string|undefined {
  common.printDebug(`- submit job ${jclFile}`);

  common.printTrace(`- content of ${jclFile}`);
  const catResult = shell.execOutSync('sh', '-c', `cat "${jclFile}" 2>&1`);
  if (catResult.rc != 0) {
    common.printTrace(`  * Failed`);
    common.printTrace(`  * Exit code: ${catResult.rc}`);
    common.printTrace(`  * Output:`);
    common.printTrace(stringlib.paddingLeft(catResult.out, "    "));
    return undefined;
  }
  else {
    common.printTrace(stringlib.paddingLeft(catResult.out, "    "));
  }

  // cat seems to work more reliably. sometimes, submit by itself just says it cannot find a real dataset.
  const result=shell.execOutSync('sh', '-c', `cat "${jclFile}" | submit 2>&1`);
  // expected: JOB JOB????? submitted from path '...'
  const code=result.rc;
  if (code==0) {
    let jobidlines = result.out.split('\n').filter(line=>line.indexOf('submitted')!=-1);
    let jobid = jobidlines.length > 0 ? jobidlines[0].split(' ')[1] : undefined;
    if (!jobid) {
      jobidlines = result.out.split('\n').filter(line=>line.indexOf('$HASP')!=-1);
      jobid = jobidlines.length > 0 ? jobidlines[0].split(' ')[1] : undefined;
    }
    if (!jobid) {
      common.printDebug(`  * Failed to find job ID`);
      common.printError(`  * Exit code: ${code}`);
      common.printError(`  * Output:`);
      if (result.out) {
        common.printError(stringlib.paddingLeft(result.out, "    "));
      }
      return undefined;
    } else {
      common.printDebug(`  * Succeeded with job ID ${jobid}`);
      common.printTrace(`  * Exit code: ${code}`);
      common.printTrace(`  * Output:`);
      if (result.out) {
        common.printTrace(stringlib.paddingLeft(result.out, "    "));
      }
      return jobid;
    }
  } else {
    common.printDebug(`  * Failed`);
    common.printError(`  * Exit code: ${code}`);
    common.printError(`  * Output:`);
    if (result.out) {
      common.printError(stringlib.paddingLeft(result.out, "    "));
    }

    return undefined;
  }
}

export function waitForJob(jobid: string): {jobcctext?: string, jobcccode?: string, jobid?: string, jobname?: string, rc: number} {
  let jobstatus;
  let jobname;
  let jobcctext;
  let jobcccode;    
  let is_jes3;

  common.printDebug(`- Wait for job ${jobid} completed, starting at ${new Date().toString()}.`);
  // wait for job to finish
  const timesSec = [1, 5, 10, 20, 30, 60, 100, 300, 500];
  for (let i = 0; i < timesSec.length; i++) {
    jobcctext = undefined;
    jobcccode = undefined;
    jobname = undefined;
    is_jes3 = false;
    const secs = timesSec[i];
    common.printTrace(`  * Wait for ${secs} seconds`);
    os.sleep(secs*1000);
    
    let result=zoslib.operatorCommand(`\\$D ${jobid},CC`);
    // if it's JES3, we receive this:
    // ...             ISF031I CONSOLE IBMUSER ACTIVATED
    // ...            -$D JOB00132,CC
    // ...  IBMUSER7   IEE305I $D       COMMAND INVALID
    is_jes3=result.out ? result.out.match(new RegExp('\$D \+COMMAND INVALID')) : false;
    if (is_jes3) {
      common.printDebug(`  * JES3 identified`);
      const show_jobid=jobid.substring(3);
      result=zoslib.operatorCommand(`*I J=${show_jobid}`);
      // $I J= gives ...
      // ...            -*I J=00132
      // ...  JES3       IAT8674 JOB BPXAS    (JOB00132) P=15 CL=A        OUTSERV(PENDING WTR)
      // ...  JES3       IAT8699 INQUIRY ON JOB STATUS COMPLETE,       1 JOB  DISPLAYED
      try {
        jobname=result.out.split('\n').filter(line=>line.indexOf('IAT8674') != -1)[0].replace(new RegExp('^.*IAT8674 *JOB *', 'g'), '').split(' ')[0];
      } catch (e) {

      }
      break;
    } else {
      // $DJ gives ...
      // ... $HASP890 JOB(JOB1)      CC=(COMPLETED,RC=0)  <-- accept this value
      // ... $HASP890 JOB(GIMUNZIP)  CC=()  <-- reject this value
      try {
        const hasplines = result.out.split('\n').filter(line => line.indexOf('$HASP890') != -1);
        if (hasplines && hasplines.length > 0) {
          const jobline = hasplines[0];
          const nameIndex = jobline.indexOf('JOB(');
          const ccIndex = jobline.indexOf('CC=(');
          jobname = jobline.substring(nameIndex+4, jobline.indexOf(')', nameIndex));
          const cc = jobline.substring(ccIndex+4, jobline.indexOf(')', ccIndex)).split(',');
          jobcctext = cc[0];
          if (cc.length > 1) {
            const equalSplit = cc[1].split('=');
            if (equalSplit.length > 1) {
              jobcccode = equalSplit[1];
            }
          }
          common.printTrace(`  * Job (${jobname}) status is ${jobcctext},RC=${jobcccode}`);
          if ((jobcctext && jobcctext.length > 0) || (jobcccode && jobcccode.length > 0)) {
            // job have CC state
            break;
          }
        }
      } catch (e) {
        break;
      }
    }
  }
  common.printTrace(`  * Job status check done at ${new Date().toString()}.`);

  if (jobcctext || jobcccode) {
    common.printDebug(`  * Job (${jobname}) exits with code ${jobcccode} (${jobcctext}).`);
    if (jobcccode == "0") {
      return {jobcctext, jobcccode, jobname, rc: 0};
    } else {
      // ${jobcccode} could be greater than 255
      return {jobcctext, jobcccode, jobname, rc: 2};
    }
  } else if (is_jes3) {
    common.printTrace(`  * Cannot determine job complete code. Please check job log manually.`);
    return {jobcctext, jobcccode, jobname, rc: 0};
  } else {
    common.printError(`  * Job (${jobname? jobname : jobid}) doesn't finish within max waiting period.`);
    return {jobcctext, jobcccode, jobname, rc: 1};
  }
}
