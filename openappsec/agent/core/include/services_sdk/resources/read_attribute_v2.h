 

#ifndef __READ_ATTRIBUTE_V2_H__
#define __READ_ATTRIBUTE_V2_H__

#include "intelligence_is_v2/data_string_v2.h"
#include "intelligence_is_v2/data_map_v2.h"

template <typename UserSerializableReply>
class ReadAttribute
{
public:
    ReadAttribute(const std::string &_key, UserSerializableReply &_data);

    template <typename Archive> void serialize(Archive &ar);

    UserSerializableReply getData() const;

private:
    std::string key = "";
    UserSerializableReply &data;
};

#include "intelligence_is_v2/read_attribute_v2_impl.h"

#endif //__READ_ATTRIBUTE_V2_H__
