 

#ifndef __DATA_STRING_H__
#define __DATA_STRING_H__

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
    std::string data;
};

#endif // __DATA_STRING_H__
