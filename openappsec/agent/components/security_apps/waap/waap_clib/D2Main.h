 

#pragma once
#include <string>
#include <vector>
#include <functional>
#include "FpMitigation.h"
#include "BehaviorAnalysis.h"

struct D2InputData {
    std::string siteId;
    std::string sourceIdentifier;
    std::string userAgent;
    std::string uri;
    std::string param;
    std::vector<std::string> keywordMatches;
    double score;
    std::string location;
};

struct D2OutputData {
    double finalScore;
    double absoluteReputation;
    double relativeReputation;
    double fpMitigationScore;
    PolicyCounterType fpClassification;
    double reputationMean;
    double variance;

    D2OutputData() : finalScore(0.0),
        absoluteReputation(0.0),
        relativeReputation(0.0),
        fpMitigationScore(0.0),
        fpClassification(UNKNOWN_TYPE),
        reputationMean(0.0),
        variance(0.0)
    {
    }
};

class D2Main {
public:
    D2Main(const std::string& assetId);
    virtual ~D2Main();
    virtual D2OutputData analyzeData(const D2InputData& inputData);

private:
    std::string m_assetId;
    std::unique_ptr<FpMitigationScore> m_fpMitigation;
    BehaviorAnalyzer m_BehaviorAnalyzer;
};

bool operator==(const D2OutputData& lhs, const D2OutputData& rhs);
