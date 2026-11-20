/*! \file array.hpp
    \brief Support for types found in \<array\>
    \ingroup STLSupport */

#ifndef CEREAL_TYPES_ARRAY_HPP_
#define CEREAL_TYPES_ARRAY_HPP_

#include <cereal/cereal.hpp>
#include <array>

namespace cereal
{
  //! Saving for std::array primitive types
  //! using binary serialization, if supported
  template <class Archive, class T, size_t N> inline
  typename std::enable_if<traits::is_output_serializable<BinaryData<T>, Archive>::value
                          && std::is_arithmetic<T>::value, void>::type
  CEREAL_SAVE_FUNCTION_NAME( Archive & ar, std::array<T, N> const & array )
  {
    ar( binary_data( array.data(), sizeof(array) ) );
  }

  //! Loading for std::array primitive types
  //! using binary serialization, if supported
  template <class Archive, class T, size_t N> inline
  typename std::enable_if<traits::is_input_serializable<BinaryData<T>, Archive>::value
                          && std::is_arithmetic<T>::value, void>::type
  CEREAL_LOAD_FUNCTION_NAME( Archive & ar, std::array<T, N> & array )
  {
    ar( binary_data( array.data(), sizeof(array) ) );
  }

  //! Saving for std::array all other types
  template <class Archive, class T, size_t N> inline
  typename std::enable_if<!traits::is_output_serializable<BinaryData<T>, Archive>::value
                          || !std::is_arithmetic<T>::value, void>::type
  CEREAL_SAVE_FUNCTION_NAME( Archive & ar, std::array<T, N> const & array )
  {
    for( auto const & i : array )
      ar( i );
  }

  //! Loading for std::array all other types
  template <class Archive, class T, size_t N> inline
  typename std::enable_if<!traits::is_input_serializable<BinaryData<T>, Archive>::value
                          || !std::is_arithmetic<T>::value, void>::type
  CEREAL_LOAD_FUNCTION_NAME( Archive & ar, std::array<T, N> & array )
  {
    for( auto & i : array )
      ar( i );
  }
} // namespace cereal

#endif // CEREAL_TYPES_ARRAY_HPP_
