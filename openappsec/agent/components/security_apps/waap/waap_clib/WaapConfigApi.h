 

#pragma once
#ifndef __WAAP_CONFIG_API_H__
#define __WAAP_CONFIG_API_H__

#include <set>

#include "WaapConfigBase.h"
#include "log_generator.h"
#include "debug.h"

class WaapConfigAPI : public WaapConfigBase
{
public:
    WaapConfigAPI();

    void load(cereal::JSONInputArchive& ar);
    bool operator==(const WaapConfigAPI& other) const;
    void printMe(std::ostream& os) const;

    virtual const std::string& get_PracticeSubType() const;
    static bool getWaapAPIConfig(WaapConfigAPI &ngenAPIConfig);
    static void notifyAssetsCount();
    static void clearAssetsCount();
    virtual WaapConfigType getType() const override { return WaapConfigType::API; }

private:

    static const std::string s_PracticeSubType;
    static std::set<std::string> assets_ids;
    static std::set<std::string> assets_ids_aggregation;
};

#endif // __WAAP_CONFIG_API_H__
