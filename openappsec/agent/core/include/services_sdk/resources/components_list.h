 

#ifndef __COMPONENTS_LIST_H__
#define __COMPONENTS_LIST_H__

#include <string>

#include "component_is/components_list_impl.h"

template <typename ... Components>
class NodeComponents : public Infra::ComponentListCore<Components...>
{
public:
    int run(const std::string &nano_service_name, int argc, char **argv);
};

template <typename TableKey, typename ... Components>
class NodeComponentsWithTable : public NodeComponents<Table<TableKey>, Components...>
{
};

#include "component_is/node_components_impl.h"

#endif // __COMPONENTS_LIST_H__
