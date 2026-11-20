 

#ifndef __OPAQUE_REPO_H__
#define __OPAQUE_REPO_H__

#include "table/opaque_basic.h"

#include "cereal/details/static_object.hpp"

class TableOpaqueRep
{
    using Gen = std::unique_ptr<TableOpaqueBase>(*)();

public:
    void addType(const std::string &name, const Gen &gen, const uint &curr, const uint &min);
    std::unique_ptr<TableOpaqueBase> getOpaqueByName(const std::string &name);

private:
    std::map<std::string, Gen> GenRep;
    std::map<std::string, uint> GenMinVer;
    std::map<std::string, uint> GenCurrVer;
};

template <typename Opaque>
class AddToTableOpaqueRepo
{
public:
    AddToTableOpaqueRepo();
};

template <typename Opaque>
AddToTableOpaqueRepo<Opaque>::AddToTableOpaqueRepo()
{
    auto &rep = ::cereal::detail::StaticObject<TableOpaqueRep>::getInstance();
    rep.addType(Opaque::name(), Opaque::prototype, Opaque::currVer(), Opaque::minVer());
}

#endif // __OPAQUE_REPO_H__
