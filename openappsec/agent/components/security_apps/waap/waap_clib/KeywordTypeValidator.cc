 

#include "KeywordTypeValidator.h"
#include <cereal/archives/json.hpp>
#include <cereal/types/unordered_map.hpp>
#include <cereal/types/unordered_set.hpp>
#include "debug.h"

USE_DEBUG_FLAG(D_WAAP);

KeywordTypeValidator::KeywordTypeValidator(const std::string &mapFilePath) :
    SerializeToFileBase(mapFilePath),
    m_serializedData(),
    m_keywordTypeMap(m_serializedData.m_keywordTypeMap)
{
    restore();
}

KeywordTypeValidator::~KeywordTypeValidator()
{

}

void KeywordTypeValidator::serialize(std::ostream &stream)
{
    (void)stream;
}

void KeywordTypeValidator::saveData()
{
    // do not override existing file
}

void KeywordTypeValidator::deserialize(std::istream &stream)
{
    try
    {
        cereal::JSONInputArchive archive(stream);

        archive(
            cereal::make_nvp("waap_kw_type_map", m_serializedData)
        );
    }
    catch (std::runtime_error & e) {
        dbgWarning(D_WAAP) << "failed to deserialize keyword types validator file. Error: " << e.what();
        throw e;
    }

}

void KeywordTypeValidator::operator=(const KeywordTypeValidator &other) {
    m_serializedData.m_keywordTypeMap = other.m_serializedData.m_keywordTypeMap;
}

bool KeywordTypeValidator::isKeywordOfType(const std::string &keyword, ParamType type) const
{
    auto keywordEntry = m_keywordTypeMap.find(keyword);
    if (keywordEntry != m_keywordTypeMap.end())
    {
        auto &typeSet = keywordEntry->second;
        return (typeSet.count(type) != 0);
    }
    else
    {
        dbgTrace(D_WAAP) << "keyword: " << keyword << " not found";
    }
    return false;
}
