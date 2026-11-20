 

#ifndef __DATA_STRING_V2_H__
#define __DATA_STRING_V2_H__

#include <string>
#include "cereal/archives/json.hpp"

class DataString
{
public:
    DataString() {}
    DataString(const DataString& _data) : data(_data.data){}

    template <typename Archive>
    void
    serialize(Archive &ar, const std::string &key)
    {
        ar(cereal::make_nvp(key, data));
    }

    const std::string & toString() const { return data; }

private:
    std::string data = "";
};

#endif // __DATA_STRING_V2_H__
