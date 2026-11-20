 

#pragma once
#ifndef __WAAP_CONFIG_APPLICATION_H__
#define __WAAP_CONFIG_APPLICATION_H__

#include <set>

#include "WaapConfigBase.h"
#include "log_generator.h"
#include "i_environment.h"
#include "debug.h"

class WaapConfigApplication
        :
    public WaapConfigBase,
    Singleton::Consume<I_Environment>
{
public:
    WaapConfigApplication();

    bool operator==(const WaapConfigApplication& other) const;

    virtual const std::string& get_PracticeSubType() const;

    void load(cereal::JSONInputArchive& ar);
    void printMe(std::ostream& os) const;
    static bool getWaapSiteConfig(WaapConfigApplication& ngenSiteConfig);
    static void notifyAssetsCount();
    static void clearAssetsCount();
    virtual WaapConfigType getType() const override { return WaapConfigType::Application; }

private:
    static const std::string s_PracticeSubType;
    static std::set<std::string> assets_ids;
    static std::set<std::string> assets_ids_aggregation;
};

#endif // __WAAP_CONFIG_APPLICATION_H__
