 

#ifndef __WAAP_SAMPLE_VALUE_H__
#define __WAAP_SAMPLE_VALUE_H__

#include <memory>
#include <vector>
#include <string>
#include "Waf2Regex.h"
#include "WaapRegexPreconditions.h"
#include "buffer.h"

class Signatures;

class SampleValue
{
public:
    SampleValue(const std::string &sample, const Signatures* signatures);
    const std::string &getSampleString() const;
    void findMatches(const Regex &pattern, std::vector<RegexMatch> &matches) const;

private:
    std::string m_sample;
    const Signatures* m_signatures;
    Waap::RegexPreconditions::PmWordSet m_pmWordSet;
};

#endif // __WAAP_SAMPLE_VALUE_H__
