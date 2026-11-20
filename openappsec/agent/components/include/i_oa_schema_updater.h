 

#ifndef __I_OA_SCHEMA_UPDATER_H__
#define __I_OA_SCHEMA_UPDATER_H__

#include <string>
#include "i_transaction.h"
#include "../security_apps/waap/waap_clib/oasu_key_types.h"
#include "../security_apps/waap/waap_clib/events_for_oa_schema.h"

class I_OASUpdater
{
public:
    virtual void onKvt(const std::string &value, SchemaKeyType type, IWaf2Transaction &waf2Transaction) = 0;
    virtual void addOperationField(
        const std::string &operation_name,
        const std::string &operation_type,
        const std::string &field_name,
        IWaf2Transaction &waf2Transaction) = 0;
    virtual void removeGraphQLData(IWaf2Transaction &waf2Transaction) = 0;
    virtual void addActiveOperationName(
        const std::string &operation_name,
        IWaf2Transaction &waf2Transaction) = 0;
};

#endif // __I_OA_SCHEMA_UPDATER_H__
