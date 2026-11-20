 

#pragma once

class IWaf2Transaction;
class IWaapConfig;
struct AnalysisResult;

class I_DeepAnalyzer {
public:
    virtual AnalysisResult analyzeData(IWaf2Transaction* waf2Trans, const IWaapConfig* pSitePolicy) = 0;
    virtual ~I_DeepAnalyzer() {};
};
