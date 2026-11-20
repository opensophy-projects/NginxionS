 

#pragma once
#include "ConfidenceCalculator.h"

class ConfidenceFileDecryptor : public RestGetFile
{
public:
    ConfidenceFileDecryptor();

    Maybe<ConfidenceCalculator::ConfidenceSet>
        getConfidenceSet() const;
    Maybe<ConfidenceCalculator::ConfidenceLevels>
        getConfidenceLevels() const;
    Maybe<std::vector<std::string>>
        getTrackingKeys() const;

private:
    S2C_PARAM(ConfidenceCalculator::ConfidenceSet, confidence_set);
    S2C_OPTIONAL_PARAM(ConfidenceCalculator::ConfidenceLevels, confidence_levels);
    S2C_OPTIONAL_PARAM(std::vector<std::string>, tracking_keys);
};

class ConfidenceFileEncryptor : public RestGetFile
{
public:
    ConfidenceFileEncryptor(const ConfidenceCalculator::ConfidenceSet &_confidence_set,
        const ConfidenceCalculator::ConfidenceLevels &_confidence_levels);

private:
    C2S_PARAM(ConfidenceCalculator::ConfidenceSet, confidence_set);
    C2S_PARAM(ConfidenceCalculator::ConfidenceLevels, confidence_levels);
};
