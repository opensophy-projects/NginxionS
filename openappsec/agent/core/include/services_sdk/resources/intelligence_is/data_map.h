 

#ifndef __DATA_MAP_H__
#define __DATA_MAP_H__

#include <vector>
#include <string>
#include <sstream>
#include <iterator>
#include <iostream>

#include "common.h"

class DataMap
{
public:
    DataMap() {}
    DataMap(const DataMap &_data) : data(_data.data) {}

    template <typename Archive>
    void
    serialize(Archive &ar, const std::string &key)
    {
        ar(cereal::make_nvp(key, data));
    }

    std::string
    toString() const
    {
        std::ostringstream os;
        bool not_first = false;
        os << "{";
        for (const auto &element : data) {
            if (not_first) os << ", ";
            os << element.first << ":" << element.second;
            not_first = true;
        }
        os << "}";
        return os.str();
    }

    const std::map<std::string, std::string> &
    getMapData() const
    {
        return data;
    }

private:
    std::map<std::string, std::string> data = {};
};

#endif // __DATA_MAP_H__
