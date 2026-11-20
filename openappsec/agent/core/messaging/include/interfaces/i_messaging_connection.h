 

#ifndef __I_MESSAGING_CONNECTION_H__
#define __I_MESSAGING_CONNECTION_H__

#include <map>
#include <string>

#include "http_request.h"
#include "i_messaging.h"

#include "connection.h"
#include "maybe_res.h"

class I_MessagingConnection
{
public:
    virtual Maybe<Connection> establishConnection(const MessageMetadata &metadata, MessageCategory category) = 0;
    virtual void clearConnections() = 0;

    virtual Maybe<Connection> getPersistentConnection(
        const std::string &host_name, uint16_t port, MessageCategory category
    ) = 0;

    virtual Maybe<Connection> getFogConnectionByCategory(MessageCategory category) = 0;
    virtual Maybe<HTTPResponse, HTTPResponse> sendRequest(Connection &connection, HTTPRequest request) = 0;

protected:
    virtual ~I_MessagingConnection() {}
};

#endif // __I_MESSAGING_CONNECTION_H__
