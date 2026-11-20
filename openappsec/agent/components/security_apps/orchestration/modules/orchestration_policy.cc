 

#include "orchestration_policy.h"

using namespace std;
using namespace cereal;

const string &
OrchestrationPolicy::getFogAddress() const
{
    return fog_address;
}

unsigned int
OrchestrationPolicy::getSleepInterval() const
{
    return sleep_interval;
}

unsigned int
OrchestrationPolicy::getErrorSleepInterval() const
{
    return error_sleep_interval;
}

void
OrchestrationPolicy::serialize(JSONInputArchive &archive)
{
    try {
        archive(make_nvp("fog-address", fog_address));
        archive(make_nvp("pulling-interval", sleep_interval));
        archive(make_nvp("error-pulling-interval", error_sleep_interval));
    } catch (const cereal::Exception&) {
        archive(make_nvp("orchestration", *this));
    }
}

bool
OrchestrationPolicy::operator==(const OrchestrationPolicy &other) const
{
    return  error_sleep_interval == other.error_sleep_interval &&
            sleep_interval       == other.sleep_interval       &&
            fog_address          == other.fog_address;
}

bool
OrchestrationPolicy::operator!=(const OrchestrationPolicy &other) const
{
    return !((*this) == other);
}
