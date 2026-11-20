 

#pragma once
#include "IndicatorsFilterBase.h"
#include "ConfidenceCalculator.h"
#include "WaapParameters.h"


#define CONFIDENCE_MIN_SOURCES 3
#define CONFIDENCE_MIN_INTERVALS 5
#define CONFIDENCE_THRESHOLD 0.8
#define CONFIDENCE_WINDOW_INTERVAL std::chrono::minutes(120)
#define CONFIDENCE_MAX_MEMORY_USAGE (40 * 1024 * 1024) // 40MB


class KeywordIndicatorFilter : public IndicatorFilterBase
{
public:
    KeywordIndicatorFilter(std::string dirPath,
        const std::string& remotePath,
        const std::string& assetId,
        I_IgnoreSources* ignoreSources,
        TuningDecision* tuning = nullptr,
        size_t minSources = CONFIDENCE_MIN_SOURCES,
        size_t minIntervals = CONFIDENCE_MIN_INTERVALS,
        std::chrono::minutes intervalDuration = CONFIDENCE_WINDOW_INTERVAL,
        double ratioThreshold = CONFIDENCE_THRESHOLD);

    ~KeywordIndicatorFilter();

    virtual void registerKeywords(const std::string& key, Waap::Keywords::KeywordsSet& keywords,
        IWaf2Transaction* pTransaction);
    bool shouldTrack(const std::string& key, const Waap::Keywords::KeywordsSet& keywords);

    virtual bool shouldFilterKeyword(const std::string &key, const std::string &keyword) const;

    bool loadParams(std::shared_ptr<Waap::Parameters::WaapParameters> pParams);
private:
    void registerSource(const std::string &key, const std::string &source);
};
