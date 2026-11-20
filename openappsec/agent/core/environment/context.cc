 

#include "context.h"
#include "i_environment.h"
#include "singleton.h"

using namespace std;

void
Context::activate()
{
    Singleton::Consume<I_Environment>::by<Context>()->registerContext(this);
}

void
Context::deactivate()
{
    Singleton::Consume<I_Environment>::by<Context>()->unregisterContext(this);
}

map<string, string>
Context::getAllStrings(const EnvKeyAttr::ParamAttr &param) const
{
    map<string, string> result;
    for (auto &entry : values) {
        if (entry.first.doesMatch(param)) {
            auto entry_value = entry.second->getString();
            if (entry_value.ok()) result[entry.first.first] = *entry_value;
        }
    }
    return result;
}

static const AlertInfo alert(AlertTeam::CORE, "environment contexts");

const std::string
Context::convertToString(MetaDataType type)
{
    switch (type) {
        case MetaDataType::File: return "file";
        case MetaDataType::SubjectIpAddr: return "subjectIp";
        case MetaDataType::OtherIpAddr: return "otherIp";
        case MetaDataType::Port: return "port";
        case MetaDataType::Protocol: return "protocol";
        case MetaDataType::Service: return "service";
        case MetaDataType::User: return "user";
        case MetaDataType::Domain: return "domain";
        case MetaDataType::Url: return "url";
        case MetaDataType::Direction: return "direction";
        case MetaDataType::Email: return "email";
        case MetaDataType::COUNT:
            dbgAssertOpt(false) << alert << "COUNT is not a valid meta data type";
            return "invalid_count";
    }
    dbgAssertOpt(false) << alert << "Reached impossible case with type=" << static_cast<int>(type);
    return "invalid_metadata_type";
}

map<string, uint64_t>
Context::getAllUints(const EnvKeyAttr::ParamAttr &param) const
{
    map<string, uint64_t> result;
    for (auto &entry : values) {
        if (entry.first.doesMatch(param)) {
            auto entry_value = entry.second->getUint();
            if (entry_value.ok()) result[entry.first.first] = *entry_value;
        }
    }
    return result;
}

map<string, bool>
Context::getAllBools(const EnvKeyAttr::ParamAttr &param) const
{
    map<string, bool> result;
    for (auto &entry : values) {
        if (entry.first.doesMatch(param)) {
            auto entry_value = entry.second->getBool();
            if (entry_value.ok()) result[entry.first.first] = *entry_value;
        }
    }
    return result;
}

ScopedContext::ScopedContext()
{
    activate();
}

ScopedContext::~ScopedContext()
{
    deactivate();
}
