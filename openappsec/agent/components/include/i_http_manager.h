 

#ifndef __I_HTTP_MANAGER_H__
#define __I_HTTP_MANAGER_H__

#include "http_inspection_events.h"

class I_HttpManager
{
public:
    virtual FilterVerdict inspect(const HttpTransactionData &event) = 0;
    virtual FilterVerdict inspect(const HttpHeader &event, bool is_request) = 0;
    virtual FilterVerdict inspect(const HttpBody &event, bool is_request) = 0;
    virtual FilterVerdict inspect(const ResponseCode &event) = 0;
    virtual FilterVerdict inspectEndRequest() = 0;
    virtual FilterVerdict inspectEndTransaction() = 0;
    virtual FilterVerdict inspectDelayedVerdict() = 0;

protected:
    virtual ~I_HttpManager() {}
};

#endif // __I_HTTP_MANAGER_H__
