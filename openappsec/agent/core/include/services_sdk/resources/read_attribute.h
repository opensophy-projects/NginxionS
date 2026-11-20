 

#ifndef __READ_ATTRIBUTE_H__
#define __READ_ATTRIBUTE_H__

#include "intelligence_is/data_string.h"

template <typename UserSerializableReply>
class ReadAttribute
{
public:
    ReadAttribute(const std::string &_key, UserSerializableReply &_data);

    template <typename Archive> void serialize(Archive &ar);

    UserSerializableReply getData() const;
    std::map<std::string, std::string> getMainAttributes() const;

private:
    std::string key;
    UserSerializableReply &data;
};

#include "intelligence_is/read_attribute_impl.h"

#endif //__READ_ATTRIBUTE_H__
