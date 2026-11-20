 

#ifndef __I_MESSAGING_BUFFER_H__
#define __I_MESSAGING_BUFFER_H__

#include <iostream>
#include <sstream>
#include <string>

#include "i_messaging.h"

#include "../buffered_message.h"
#include "cereal/archives/json.hpp"
#include "cereal/types/string.hpp"
#include "maybe_res.h"

class I_MessageBuffer
{
public:
    virtual void pushNewBufferedMessage(
        const std::string &body,
        HTTPMethod method,
        const std::string &uri,
        MessageCategory category,
        MessageMetadata message_metadata,
        bool force_immediate_writing
    ) = 0;

    virtual Maybe<BufferedMessage> peekMessage() = 0;
    virtual void popMessage() = 0;
    virtual void cleanBuffer() = 0;
};

#endif // __I_MESSAGING_BUFFER_H__
