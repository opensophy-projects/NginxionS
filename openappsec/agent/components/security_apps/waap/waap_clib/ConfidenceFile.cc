 

#include "ConfidenceFile.h"

ConfidenceFileDecryptor::ConfidenceFileDecryptor()
{
}

Maybe<ConfidenceCalculator::ConfidenceSet> ConfidenceFileDecryptor::getConfidenceSet() const
{
    if (!confidence_set.get().empty()) return confidence_set.get();
    return genError("failed to get file");
}

Maybe<ConfidenceCalculator::ConfidenceLevels> ConfidenceFileDecryptor::getConfidenceLevels() const
{
    if (!confidence_levels.get().empty()) return confidence_levels.get();
    return genError("failed to get confidence levels");
}

Maybe<std::vector<std::string>> ConfidenceFileDecryptor::getTrackingKeys() const
{
    if (!tracking_keys.get().empty()) return tracking_keys.get();
    return genError("failed to get tracking keys");
}


ConfidenceFileEncryptor::ConfidenceFileEncryptor(const ConfidenceCalculator::ConfidenceSet &_confidence_set,
    const ConfidenceCalculator::ConfidenceLevels &_confidence_levels) :
    confidence_set(_confidence_set), confidence_levels(_confidence_levels)
{
}
