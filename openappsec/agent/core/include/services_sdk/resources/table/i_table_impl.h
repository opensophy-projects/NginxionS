 

#ifndef __I_TABLE_IMPL_H__
#define __I_TABLE_IMPL_H__

#ifndef __I_TABLE_H__
#error "i_table_impl.h should not be included directly"
#endif // __I_TABLE_H__

#include "common.h"
#include "debug.h"

template <typename Opaque>
bool
I_Table::hasState() const
{
    return hasState(typeid(Opaque));
}

template <typename Opaque, typename ...Args>
bool
I_Table::createState(Args ...args)
{
    std::unique_ptr<TableOpaqueBase>  ptr = std::make_unique<Opaque>(std::forward<Args>(args)...);
    return createState(typeid(Opaque), std::move(ptr));
}

template <typename Opaque>
void
I_Table::deleteState()
{
    deleteState(typeid(Opaque));
}

template <typename Opaque>
Opaque &
I_Table::getState()
{
    Opaque *ptr = static_cast<Opaque *>(getState(typeid(Opaque)));
    dbgAssert(ptr != nullptr)
        << AlertInfo(AlertTeam::CORE, "table")
        << "Trying to access a non existing opaque "
        << typeid(Opaque).name();
    return *ptr;
}

#endif // __I_TABLE_IMPL_H__
