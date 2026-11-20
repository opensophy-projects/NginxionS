/*! \file utility.hpp
    \brief Support for types found in \<utility\>
    \ingroup STLSupport */

#ifndef CEREAL_TYPES_UTILITY_HPP_
#define CEREAL_TYPES_UTILITY_HPP_

#include <cereal/cereal.hpp>
#include <utility>

namespace cereal
{
  //! Serializing for std::pair
  template <class Archive, class T1, class T2> inline
  void CEREAL_SERIALIZE_FUNCTION_NAME( Archive & ar, std::pair<T1, T2> & pair )
  {
    ar( CEREAL_NVP_("first",  pair.first),
        CEREAL_NVP_("second", pair.second) );
  }
} // namespace cereal

#endif // CEREAL_TYPES_UTILITY_HPP_
