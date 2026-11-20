 

#ifndef __NEW_AUTO_UPGRADE_H__
#define __NEW_AUTO_UPGRADE_H__

#include <string>
#include <cereal/archives/json.hpp>
#include <boost/uuid/uuid.hpp>
#include <boost/uuid/uuid_generators.hpp>
#include <boost/uuid/uuid_io.hpp>

#include "config.h"
#include "debug.h"
#include "local_policy_common.h"

class AppSecAutoUpgradeSpec
{
public:
    void load(cereal::JSONInputArchive &archive_in);
    void save(cereal::JSONOutputArchive& out_ar) const;

    const std::string & getAppSecClassName() const;
    const std::string & getName() const;
    void setName(const std::string &_name);

private:
    std::string mode = "automatic";
    std::vector<std::string> days;
    std::string upgrade_window_start_hour_UTC;
    uint upgrade_window_duration;

    std::string name;
    std::string appsec_class_name;
};

#endif // __NEW_AUTO_UPGRADE_H__
