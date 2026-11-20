 

#ifndef __CONNECTION_H__
#define __CONNECTION_H__

#include <map>
#include <memory>
#include <string>

#include "i_agent_details.h"
#include "i_environment.h"
#include "i_mainloop.h"
#include "i_time_get.h"
#include "messaging/http_response.h"
#include "messaging/messaging_metadata.h"

#include "maybe_res.h"

class MessageConnectionKey
{
public:
    MessageConnectionKey() {}

    MessageConnectionKey(const std::string &_host_name, uint16_t _port, MessageCategory _category) :
        host_name(_host_name), port(_port), category(_category)
    {}

    const std::string & getHostName() const;
    uint16_t getPort() const;
    const MessageCategory & getCategory() const;

    bool operator<(const MessageConnectionKey &other) const;

private:
    std::string host_name;
    uint16_t port;
    MessageCategory category;
};

class Connection
{
public:
    Connection(const MessageConnectionKey &conn_key, const MessageMetadata &metadata);
    ~Connection();

    Maybe<void> setProxySettings(const MessageProxySettings &settings);
    void setExternalCertificate(const std::string &certificate);
    const MessageProxySettings & getProxySettings() const;
    const std::string & getExternalCertificate() const;

    const MessageConnectionKey &getConnKey() const;
    bool isOverProxy() const;
    bool isUnsecure() const;
    bool isSuspended();
    bool shouldCloseConnection() const;

    Maybe<void> establishConnection();
    Maybe<HTTPResponse, HTTPResponse> sendRequest(const std::string &request, HTTPMethod method);

private:
    class Impl;
    std::shared_ptr<Impl> pimpl;
};

#endif // __CONNECTION_H__
