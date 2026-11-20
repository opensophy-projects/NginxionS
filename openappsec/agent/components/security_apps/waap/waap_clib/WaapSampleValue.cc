 

#include "WaapSampleValue.h"
#include "Signatures.h"
#include "debug.h"

USE_DEBUG_FLAG(D_WAAP_SAMPLE_SCAN);

SampleValue::SampleValue(const std::string &sample, const Signatures* signatures)
    :
        m_sample(sample),
        m_signatures(signatures),
        m_pmWordSet()
{
    if (m_signatures) {
        if (m_signatures->m_regexPreconditions) {
            if (!m_signatures->isHyperscanInitialized()) {
                // Run aho-corasick and related rules once the sample value is known.
                // The result pmWordSet is reused later for multiple calls to findMatches on the same sample.
                m_signatures->m_regexPreconditions->pmScan(
                    Buffer(m_sample.data(), m_sample.size(), Buffer::MemoryType::STATIC), m_pmWordSet);
            } else {
                // Add incompatible patterns from Signatures to the PmWordSet so they will be processed
                // by traditional regex matching in Regex::findAllMatches
                const auto& incompatiblePmWordSet = m_signatures->getIncompatiblePatternsPmWordSet();
                m_pmWordSet.insert(incompatiblePmWordSet.begin(), incompatiblePmWordSet.end());
            }
        }
    }
}

const std::string &
SampleValue::getSampleString() const
{
    return m_sample;
}

void
SampleValue::findMatches(const Regex &pattern, std::vector<RegexMatch> &matches) const
{
    static const size_t maxMatchesPerSignature = 5;
    pattern.findAllMatches(
        m_sample,
        matches,
        (m_signatures && m_signatures->m_regexPreconditions) ? &m_pmWordSet : nullptr,
        maxMatchesPerSignature
    );
}
