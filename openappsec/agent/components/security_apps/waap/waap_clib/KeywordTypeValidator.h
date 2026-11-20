 

#pragma once

#include <unordered_map>
#include <unordered_set>
#include "WaapEnums.h"
#include "Waf2Util.h"
#include "i_serialize.h"

class KeywordTypeValidator : public SerializeToFileBase
{
public:
    KeywordTypeValidator(const std::string& mapFilePath);
    ~KeywordTypeValidator();

    bool isKeywordOfType(const std::string& keyword, ParamType type) const;

    virtual void serialize(std::ostream& stream);
    virtual void deserialize(std::istream& stream);
    virtual void saveData();

    void operator=(const KeywordTypeValidator &other);

private:
    struct SerializedData {
        template <class Archive>
        void serialize(Archive& archive) {
            std::unordered_map<std::string, std::unordered_set<std::string>> typesStrToKeysMap;
            
            archive(cereal::make_nvp("keywordsTypeMap", typesStrToKeysMap));
            
            for (auto typeStrItr : typesStrToKeysMap)
            {
                ParamType type = Waap::Util::convertTypeStrToEnum(typeStrItr.first);
                for (auto keyword : typeStrItr.second)
                {
                    if (m_keywordTypeMap.find(keyword) == m_keywordTypeMap.end())
                    {
                        // initialize type set
                        m_keywordTypeMap[keyword];
                    }
                    m_keywordTypeMap[keyword].insert(type);
                }
            }
        }

        std::unordered_map<std::string, std::unordered_set<ParamType>> m_keywordTypeMap;
    };

    SerializedData m_serializedData;
    std::unordered_map<std::string, std::unordered_set<ParamType>> &m_keywordTypeMap;
};
