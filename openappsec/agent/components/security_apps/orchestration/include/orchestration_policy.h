 

#ifndef __ORCHESTRATION_POLICY_H__
#define __ORCHESTRATION_POLICY_H__

#include <string>
#include "cereal/archives/json.hpp"

class OrchestrationPolicy
{
public:
    const std::string & getFogAddress() const;
    unsigned int getSleepInterval() const;
    unsigned int getErrorSleepInterval() const;

    void serialize(cereal::JSONInputArchive & archive);

    bool operator==(const OrchestrationPolicy &other) const;
    bool operator!=(const OrchestrationPolicy &other) const;

private:
    std::string fog_address;
    unsigned int sleep_interval;
    unsigned int error_sleep_interval;
};

#endif // __ORCHESTRATION_POLICY_H__
