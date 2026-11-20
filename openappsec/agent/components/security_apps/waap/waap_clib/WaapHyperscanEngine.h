#ifndef __WAAP_HYPERSCAN_ENGINE_H__
#define __WAAP_HYPERSCAN_ENGINE_H__

#include <string>
#include <vector>
#include <map>
#include <set>
#include <memory>

class Signatures;
class SampleValue;
struct Waf2ScanResult;

class WaapHyperscanEngine {
public:

    WaapHyperscanEngine();
    ~WaapHyperscanEngine();

    // Initialize with patterns from Signatures
    bool initialize(const std::shared_ptr<Signatures>& signatures);

    // Main scanning function - same interface as performStandardRegexChecks
    void scanSample(const SampleValue& sample,
        Waf2ScanResult& res,
        bool longTextFound,
        bool binaryDataFound,
        bool includeKeywordRegex,
        bool includePatternRegex) const;

    // Check if the engine is ready to use
    bool isInitialized() const;

    // Get statistics
    size_t getPatternCount() const;
    size_t getCompiledPatternCount() const;
    size_t getFailedPatternCount() const;

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __WAAP_HYPERSCAN_ENGINE_H__
