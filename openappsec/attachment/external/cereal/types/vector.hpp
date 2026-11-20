/*! \file vector.hpp
    \brief Support for types found in \<vector\>
    \ingroup STLSupport */

#ifndef CEREAL_TYPES_VECTOR_HPP_
#define CEREAL_TYPES_VECTOR_HPP_

#include <cereal/cereal.hpp>
#include <vector>

namespace cereal
{
  //! Serialization for std::vectors of arithmetic (but not bool) using binary serialization, if supported
  template <class Archive, class T, class A> inline
  typename std::enable_if<traits::is_output_serializable<BinaryData<T>, Archive>::value
                          && std::is_arithmetic<T>::value && !std::is_same<T, bool>::value, void>::type
  CEREAL_SAVE_FUNCTION_NAME( Archive & ar, std::vector<T, A> const & vector )
  {
    ar( make_size_tag( static_cast<size_type>(vector.size()) ) ); // number of elements
    ar( binary_data( vector.data(), vector.size() * sizeof(T) ) );
  }

  //! Serialization for std::vectors of arithmetic (but not bool) using binary serialization, if supported
  template <class Archive, class T, class A> inline
  typename std::enable_if<traits::is_input_serializable<BinaryData<T>, Archive>::value
                          && std::is_arithmetic<T>::value && !std::is_same<T, bool>::value, void>::type
  CEREAL_LOAD_FUNCTION_NAME( Archive & ar, std::vector<T, A> & vector )
  {
    size_type vectorSize;
    ar( make_size_tag( vectorSize ) );

    vector.resize( static_cast<std::size_t>( vectorSize ) );
    ar( binary_data( vector.data(), static_cast<std::size_t>( vectorSize ) * sizeof(T) ) );
  }

  //! Serialization for non-arithmetic vector types
  template <class Archive, class T, class A> inline
  typename std::enable_if<!traits::is_output_serializable<BinaryData<T>, Archive>::value
                          || !std::is_arithmetic<T>::value, void>::type
  CEREAL_SAVE_FUNCTION_NAME( Archive & ar, std::vector<T, A> const & vector )
  {
    ar( make_size_tag( static_cast<size_type>(vector.size()) ) ); // number of elements
    for(auto && v : vector)
      ar( v );
  }

  //! Serialization for non-arithmetic vector types
  template <class Archive, class T, class A> inline
  typename std::enable_if<!traits::is_input_serializable<BinaryData<T>, Archive>::value
                          || !std::is_arithmetic<T>::value, void>::type
  CEREAL_LOAD_FUNCTION_NAME( Archive & ar, std::vector<T, A> & vector )
  {
    size_type size;
    ar( make_size_tag( size ) );

    vector.resize( static_cast<std::size_t>( size ) );
    for(auto && v : vector)
      ar( v );
  }

  //! Serialization for bool vector types
  template <class Archive, class A> inline
  void CEREAL_SAVE_FUNCTION_NAME( Archive & ar, std::vector<bool, A> const & vector )
  {
    ar( make_size_tag( static_cast<size_type>(vector.size()) ) ); // number of elements
    for(auto && v : vector)
      ar( static_cast<bool>(v) );
  }

  //! Serialization for bool vector types
  template <class Archive, class A> inline
  void CEREAL_LOAD_FUNCTION_NAME( Archive & ar, std::vector<bool, A> & vector )
  {
    size_type size;
    ar( make_size_tag( size ) );

    vector.resize( static_cast<std::size_t>( size ) );
    for(auto && v : vector)
    {
      bool b;
      ar( b );
      v = b;
    }
  }
} // namespace cereal

#endif // CEREAL_TYPES_VECTOR_HPP_
