 

#ifndef __FOG_REST_ERROR_H__
#define __FOG_REST_ERROR_H__

#include <string>

#include "rest.h"

class FogRestError : public ClientRest
{
public:
    S2C_LABEL_PARAM(string, message_id,   "messageId");
    S2C_LABEL_PARAM(string, message,      "message");
    S2C_LABEL_PARAM(string, reference_id, "referenceId");
    S2C_LABEL_PARAM(string, severity,     "severity");
};

#endif // __FOG_REST_ERROR_H__
