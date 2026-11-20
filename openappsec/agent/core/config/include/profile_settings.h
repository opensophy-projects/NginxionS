 

#ifndef __PROFILE_SETTINGS_H__
#define __PROFILE_SETTINGS_H__

#include <vector>
#include <map>
#include <string>
#include <boost/algorithm/string.hpp>

class AgentProfileSettings
{
public:
    void
    load(cereal::JSONInputArchive &ar)
    {
        std::vector<SingleSetting> settings;
        cereal::load(ar, settings);

        for (const SingleSetting &setting : settings) {
            std::pair<std::string, std::string> single_setting = setting.getSetting();
            profile_settings[boost::algorithm::trim_copy(single_setting.first)] =
                boost::algorithm::trim_copy(single_setting.second);
        }
    }

    const std::map<std::string, std::string> & getSettings() const { return profile_settings; }
    static AgentProfileSettings default_profile_settings;

private:
    class SingleSetting
    {
    public:
        void
        load(cereal::JSONInputArchive &ar)
        {
            ar(
                cereal::make_nvp("key", key),
                cereal::make_nvp("value", value)
            );
        }

        std::pair<std::string, std::string> getSetting() const { return std::make_pair(key, value); }

    private:
        std::string key;
        std::string value;
    };
    std::map<std::string, std::string> profile_settings;
};

#endif // __PROFILE_SETTINGS_H__
