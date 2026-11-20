 

#pragma once
#include <string>
#include <unordered_map>
#include <cereal/archives/json.hpp>
#include <cereal/types/unordered_map.hpp>


namespace Waap {
    namespace Parameters {
        typedef std::string Parameter;
        typedef std::string Value;
        typedef std::unordered_map<Parameter, Value> ParamMap;

        class WaapParameters
        {
        public:
            template <typename _A>
            WaapParameters(_A& ar)
            {
                ar(cereal::make_nvp("waapParameters", m_paramMap));
            }

            bool operator==(const WaapParameters &other) const;

            ParamMap getParamsMap() const;
            Value getParamVal(Parameter key, Value defaultVal);
        private:
            ParamMap m_paramMap;
        };

    }
}
