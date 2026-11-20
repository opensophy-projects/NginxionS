 

#include "intelligence_is_v2/requested_attributes_v2.h"

#include <tuple>

using namespace std;
using namespace Intelligence_IS_V2;

void
serializableAttribute::serialize(cereal::JSONOutputArchive &ar) const
{
    ar(
        cereal::make_nvp("key", key),
        cereal::make_nvp("minConfidence", min_confidence)
    );
}

void
SerializableAttributesMap::save(cereal::JSONOutputArchive &ar) const
{
    if (requested_attributes.empty()) return;

    vector<serializableAttribute> all_attributes;
    for (auto const & iter : requested_attributes) {
        serializableAttribute attribute(iter.first, iter.second);
        all_attributes.push_back(attribute);
    }

    ar(cereal::make_nvp("requestedAttributes", all_attributes));
}

void
SerializableAttributesMap::setSerializableAttribute(const string &attribute, uint confidence)
{
    requested_attributes[attribute] = confidence;
};

uint
SerializableAttributesMap::getAttributeByKey(const string &key) const
{
    return requested_attributes.at(key);
}

bool
SerializableAttributesMap::checkMinConfidence(uint upper_confidence_limit) const
{
    for (auto const &attribute : requested_attributes) {
        if (attribute.second == 0 || attribute.second > upper_confidence_limit) return false;
    }
    return true;
}
