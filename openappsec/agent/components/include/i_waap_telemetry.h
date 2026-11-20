 

#pragma once

#include "WaapEnums.h"

struct DecisionTelemetryData
{
    BlockType blockType;
    ThreatLevel threat;
    std::string assetName;
    std::string practiceId;
    std::string practiceName;
    std::string source;
    TrafficMethod method;
    int responseCode;
    uint64_t elapsedTime;
    std::set<std::string> attackTypes;
    bool temperatureDetected;

    DecisionTelemetryData() :
        blockType(NOT_BLOCKING),
        threat(NO_THREAT),
        assetName(),
        practiceId(),
        practiceName(),
        source(),
        method(POST),
        responseCode(0),
        elapsedTime(0),
        attackTypes(),
        temperatureDetected(false)
    {
    }
};

class I_Telemetry
{
public:
    virtual void logDecision(std::string assetId, DecisionTelemetryData& data) = 0;
protected:
    virtual ~I_Telemetry() {}
};
