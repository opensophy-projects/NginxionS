 

#ifndef __POLICY_ACTIVATION_DATA_H__
#define __POLICY_ACTIVATION_DATA_H__

#include <vector>
#include <map>

#include "config.h"
#include "debug.h"
#include "rest.h"
#include "cereal/archives/json.hpp"
#include <cereal/types/map.hpp>
#include "customized_cereal_map.h"

#include "local_policy_common.h"

class PolicyActivationMetadata
{
public:
    void load(cereal::JSONInputArchive &archive_in);

private:
    std::string name;
};

class EnabledPolicy
{
public:
    void load(cereal::JSONInputArchive &archive_in);

    const std::string & getName() const;
    const std::vector<std::string> & getHosts() const;

private:
    std::string name;
    std::vector<std::string> hosts;
};

class PolicyActivationSpec
{
public:
    void load(cereal::JSONInputArchive &archive_in);

    const std::vector<EnabledPolicy> & getPolicies() const;

private:
    std::string appsec_class_name;
    std::vector<EnabledPolicy> policies;
};

class SinglePolicyActivationData
{
public:
    void load(cereal::JSONInputArchive &archive_in);

    const PolicyActivationSpec & getSpec() const;

private:
    std::string api_version;
    std::string kind;
    PolicyActivationMetadata metadata;
    PolicyActivationSpec spec;
};

class PolicyActivationData : public ClientRest
{
public:
    bool loadJson(const std::string &json);

    const std::vector<SinglePolicyActivationData> & getItems() const;

private:
    std::string api_version;
    std::vector<SinglePolicyActivationData> items;
};

#endif // __POLICY_ACTIVATION_DATA_H__
