 

#ifndef __TABLE_HELPERS_H__
#define __TABLE_HELPERS_H__

#ifndef __TABLE_IMPL_H__
#error "table_helpers.h should not be included directly"
#endif // __TABLE_IMPL_H__

#include "context.h"

namespace TableHelper
{

class Constant
{
protected:
    static const std::string primary_key;
};

template <typename KeyPtr>
class I_InternalTableList
{
public:
    virtual void removeKey(const KeyPtr &key) = 0;

protected:
    ~I_InternalTableList() {}
};

template <typename Key, typename ExpIter>
class I_InternalTableExpiration
{
public:
    virtual ExpIter addExpiration(std::chrono::microseconds expire, const Key &key) = 0;
    virtual void removeExpiration(const ExpIter &iter) = 0;

protected:
    ~I_InternalTableExpiration() {}
};

} // TableHelper

#endif // __TABLE_HELPERS_H__
