 

#ifndef __HTTP_CONFIGURATION_H__
#define __HTTP_CONFIGURATION_H__

#include <string>
#include <map>
#include <vector>

#include "cereal/archives/json.hpp"

struct DebugConfig
{
    void save(cereal::JSONOutputArchive &archive) const;
    void load(cereal::JSONInputArchive &archive);
    bool operator==(const DebugConfig &another) const;

    std::string client;
    std::string server;
    unsigned int port = 0;
    std::string method;
    std::string host;
    std::string uri;
};

class HttpAttachmentConfiguration
{
public:
    int init(const std::string &conf_file);

    void save(cereal::JSONOutputArchive &archive) const;
    void load(cereal::JSONInputArchive &archive);

    bool operator==(const HttpAttachmentConfiguration &other) const;

    unsigned int getNumericalValue(const std::string &key) const;
    const std::string & getStringValue(const std::string &key) const;
    const std::vector<std::string> & getExcludeSources() const { return exclude_sources; }
    const DebugConfig & getDebugContext() const { return dbg; }

    void setNumericalValue(const std::string &key, unsigned int value) { numerical_values[key] = value; }
    void setStringValue(const std::string &key, const std::string &value) { string_values[key] = value; }
    void setExcludeSources(const std::vector<std::string> &new_sources) { exclude_sources = new_sources; }
    void setDebugContext(const DebugConfig &_dbg) { dbg = _dbg; }

private:
    void loadNumericalValue(cereal::JSONInputArchive &archive, const std::string &name, unsigned int default_value);

    DebugConfig dbg;
    std::map<std::string, unsigned int> numerical_values;
    std::map<std::string, std::string> string_values;
    std::vector<std::string> exclude_sources;
    std::string empty;
};

#endif // __HTTP_CONFIGURATION_H__
