 

#include "intelligence_is_v2/asset_reply.h"

using namespace std;

template<class Archive>
void
ExternalSourceError::serialize(Archive &ar)
{
    ar(
        cereal::make_nvp("sourceID", source_id),
        cereal::make_nvp("sourceName", source_name),
        cereal::make_nvp("statusCode", status_code),
        cereal::make_nvp("errorMessage", error_message)
    );
}

void
IntelligenceQueryResponse::loadFromJson(const std::string &json_response)
{
    std::stringstream in;
    in.str(json_response);
    cereal::JSONInputArchive in_ar(in);
    serialize(in_ar);
}

template <class Archive>
void
IntelligenceQueryResponse::serialize(Archive &ar)
{
    std::string raw_data;
    ar(cereal::make_nvp("status", raw_data), cereal::make_nvp("totalNumAssets", total_num_assets));
    status = Intelligence_IS_V2::convertStringToResponseStatus(raw_data);

    try {
        ar(cereal::make_nvp("cursor", cursor));
    } catch (...) {}

    try {
        ar(cereal::make_nvp("externalSourcesErrorStatus", external_sources_errors));
    } catch (...) {}
}

const std::vector<ExternalSourceError> &
IntelligenceQueryResponse::getExternalSourcesErrorStatus() const
{
    return external_sources_errors;
}
