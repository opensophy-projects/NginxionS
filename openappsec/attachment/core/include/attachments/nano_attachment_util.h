 

#ifndef __NGINX_ATTACHMENT_UTIL__
#define __NGINX_ATTACHMENT_UTIL__

#include <stdio.h>

#include "nano_attachment_common.h"

#ifdef __cplusplus
extern "C" {
#endif // __cplusplus

#define IP_STR_MAX_LEN 40

typedef const char * c_str;

int initAttachmentConfig(c_str conf_file);

NanoHttpInspectionMode getInspectionMode();
unsigned int getNumOfNginxIpcElements();
unsigned int getKeepAliveIntervalMsec();
unsigned int getDbgLevel();
int isDebugContext(c_str client, c_str server, unsigned int port, c_str method, c_str host, c_str uri);
c_str getStaticResourcesPath();

int isFailOpenMode();
unsigned int getFailOpenTimeout();

int isFailOpenHoldMode();
unsigned int getFailOpenHoldTimeout();

unsigned int getMaxSessionsPerMinute();
int isFailOpenOnSessionLimit();

unsigned int getRegistrationThreadTimeout();

unsigned int getReqProccessingTimeout();
unsigned int getReqHeaderThreadTimeout();
unsigned int getReqBodyThreadTimeout();

unsigned int getResProccessingTimeout();
unsigned int getResHeaderThreadTimeout();
unsigned int getResBodyThreadTimeout();

unsigned int getWaitingForVerdictThreadTimeout();
unsigned int getHoldVerdictRetries();
unsigned int getHoldVerdictPollingTime();

int isIPAddress(c_str ip_str);
int isSkipSource(c_str ip_str);

unsigned int isPairedAffinityEnabled();
unsigned int isAsyncModeEnabled();

#ifdef __cplusplus
}
#endif

#endif // __NGINX_ATTACHMENT_UTIL__
