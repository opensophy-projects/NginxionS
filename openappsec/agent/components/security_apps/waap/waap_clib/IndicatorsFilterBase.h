 

#pragma once

#include "i_indicatorsFilter.h"
#include "waap.h"
#include "TrustedSources.h"
#include "TrustedSourcesConfidence.h"
#include "ConfidenceCalculator.h"
#include "TuningDecisions.h"
#include "maybe_res.h"

class IndicatorFilterBase : public I_IndicatorsFilter
{
public:
    IndicatorFilterBase(const std::string& confidence_path,
        const std::string& trusted_path,
        const std::string& remotePath,
        const std::string& assetId,
        size_t min_sources,
        size_t min_intervals,
        std::chrono::minutes interval_duration,
        double ratio_threshold,
        const std::string& null_obj,
        TuningDecision* tuning,
        I_IgnoreSources* ignoreSources = nullptr);
    virtual void filterKeywords(const std::string &key, Waap::Keywords::KeywordsSet& keywords,
        std::vector<std::string>& filteredKeywords);

    bool setTrustedSrcParameter(std::shared_ptr<Waap::TrustedSources::TrustedSourcesParameter> policy);
    void reset();
    Maybe<std::string> getTrustedSource(const IWaf2Transaction* pTransaction);
protected:
    void registerKeyword(const std::string& key,
        const std::string& keyword,
        const std::string& source,
        const std::string& trusted_src);

    ConfidenceCalculator m_confidence_calc;
    TrustedSourcesConfidenceCalculator m_trusted_confidence_calc;
    std::shared_ptr<Waap::TrustedSources::TrustedSourcesParameter> m_policy;
    TuningDecision* m_tuning;
private:
    bool isTrustedSourceOfType(const std::string& source, Waap::TrustedSources::TrustedSourceType srcType);
};
