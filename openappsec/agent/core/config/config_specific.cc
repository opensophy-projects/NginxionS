 

#include "config.h"

using namespace cereal;
using namespace std;

template<>
void
Config::ConfigLoader<bool>::readValue(JSONInputArchive &ar)
{
    ar(make_nvp("value", value));
}

template<>
void
Config::ConfigLoader<int>::readValue(JSONInputArchive &ar)
{
    ar(make_nvp("value", value));
}

template<>
void
Config::ConfigLoader<uint>::readValue(JSONInputArchive &ar)
{
    ar(make_nvp("value", value));
}

template<>
void
Config::ConfigLoader<string>::readValue(JSONInputArchive &ar)
{
    ar(make_nvp("value", value));
}

template<>
bool
Config::loadProfileSetting<bool>(const string &raw_value)
{
    if (raw_value == "true") {
        return true;
    } else if (raw_value == "false") {
        return false;
    } else {
        throw Exception("Illegal Value");
    }
}

template<>
int
Config::loadProfileSetting<int>(const string &raw_value)
{
    return stoi(raw_value);
}

template<>
uint
Config::loadProfileSetting<uint>(const string &raw_value)
{
    return stoul(raw_value);
}

template<>
string
Config::loadProfileSetting<string>(const string &raw_value)
{
    return raw_value;
}
