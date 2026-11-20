 

#ifndef __READ_ATTRIBUTE_IMPL_H__
#define __READ_ATTRIBUTE_IMPL_H__

#ifndef __READ_ATTRIBUTE_H__
#error read_attribute_impl.h should not be included directly!
#endif // __READ_ATTRIBUTE_H__

#include "debug.h"

USE_DEBUG_FLAG(D_INTELLIGENCE);

template <typename UserSerializableReply>
ReadAttribute<UserSerializableReply>::ReadAttribute(const std::string &_key, UserSerializableReply &_data)
        :
    key(_key),
    data(_data)
{}

template <typename UserSerializableReply>
template <typename Archive>
void
ReadAttribute<UserSerializableReply>::serialize(Archive &ar)
{
    dbgTrace(D_INTELLIGENCE) << "Reading asset's attributes";
    try {
        data.serialize(ar, key);
    } catch (const Intelligence_IS::IntelligenceException &e) {
        dbgWarning(D_INTELLIGENCE) << "Failed to read attributes of query response";
        ar.finishNode();

        throw e;
    }
}

template <typename UserSerializableReply>
UserSerializableReply
ReadAttribute<UserSerializableReply>::getData() const
{
    return data;
}

#endif // __READ_ATTRIBUTE_IMPL_H__
